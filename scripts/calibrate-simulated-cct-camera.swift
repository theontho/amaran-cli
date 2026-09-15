import AVFoundation
import CoreImage
import Foundation

final class FrameCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
  private let context = CIContext()
  private let lock = NSLock()
  private var pending: (url: URL, ready: DispatchSemaphore, delay: Int)?

  func capture(_ url: URL) throws {
    let ready = DispatchSemaphore(value: 0)
    lock.lock()
    pending = (url, ready, 12)
    lock.unlock()
    guard ready.wait(timeout: .now() + 10) == .success else {
      throw NSError(domain: "AmaranCamera", code: 1, userInfo: [NSLocalizedDescriptionKey: "Camera frame timed out"])
    }
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    lock.lock()
    guard var request = pending else {
      lock.unlock()
      return
    }
    if request.delay > 0 {
      request.delay -= 1
      pending = request
      lock.unlock()
      return
    }
    pending = nil
    lock.unlock()
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      request.ready.signal()
      return
    }
    do {
      let image = CIImage(cvPixelBuffer: pixelBuffer)
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
      try context.writePNGRepresentation(of: image, to: request.url, format: .RGBA8, colorSpace: colorSpace)
    } catch {
      fputs("Camera capture failed: \(error)\n", stderr)
    }
    request.ready.signal()
  }
}

func runCurl(_ path: String, body: String) throws {
  let process = Process()
  let output = Pipe()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
  process.arguments = [
    "--fail",
    "--silent",
    "--show-error",
    "--max-time",
    "70",
    "-H",
    "content-type: application/json",
    "-d",
    body,
    "http://127.0.0.1:2709\(path)",
  ]
  process.standardOutput = output
  process.standardError = output
  try process.run()
  process.waitUntilExit()
  let data = output.fileHandleForReading.readDataToEndOfFile()
  guard process.terminationStatus == 0 else {
    throw NSError(
      domain: "AmaranCamera",
      code: Int(process.terminationStatus),
      userInfo: [NSLocalizedDescriptionKey: String(decoding: data, as: UTF8.self)]
    )
  }
}

func setBack(_ body: String, action: String) throws {
  try runCurl("/lights/back/\(action)", body: body)
  Thread.sleep(forTimeInterval: 0.45)
}

let fine = CommandLine.arguments.contains("--fine")
let verify = CommandLine.arguments.contains("--verify")
let directory = URL(
  fileURLWithPath: verify
    ? "artifacts/webcam/simulated-cct-calibration-verify"
    : fine
      ? "artifacts/webcam/simulated-cct-calibration-fine"
      : "artifacts/webcam/simulated-cct-calibration"
)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
let devices = AVCaptureDevice.DiscoverySession(
  deviceTypes: [.builtInWideAngleCamera, .external],
  mediaType: .video,
  position: .unspecified
).devices
guard let device = devices.first(where: { $0.localizedName == "FaceTime HD Camera" }) else {
  fatalError("FaceTime HD Camera is unavailable")
}

try runCurl("/lights/desk/off", body: "{}")
try runCurl("/lights/front/off", body: "{}")
try setBack(#"{"kelvin":2500,"brightness":10}"#, action: "cct")

let session = AVCaptureSession()
session.beginConfiguration()
session.sessionPreset = .hd1280x720
try session.addInput(AVCaptureDeviceInput(device: device))
let output = AVCaptureVideoDataOutput()
output.alwaysDiscardsLateVideoFrames = true
output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
guard session.canAddOutput(output) else { fatalError("Cannot add camera output") }
session.addOutput(output)
session.commitConfiguration()
let capture = FrameCapture()
output.setSampleBufferDelegate(capture, queue: DispatchQueue(label: "amaran.camera.frames"))
session.startRunning()
Thread.sleep(forTimeInterval: 3)

try device.lockForConfiguration()
if device.isFocusModeSupported(.locked) { device.focusMode = .locked }
if device.isExposureModeSupported(.locked) { device.exposureMode = .locked }
if device.isWhiteBalanceModeSupported(.locked) { device.whiteBalanceMode = .locked }
device.unlockForConfiguration()
try capture.capture(directory.appendingPathComponent("native-2500.png"))

try setBack("{}", action: "off")
try capture.capture(directory.appendingPathComponent("dark.png"))

let hues = verify
  ? [33]
  : fine ? Array(stride(from: 32, through: 38, by: 1)) : Array(stride(from: 20, through: 40, by: 5))
let saturations = verify
  ? [36]
  : fine ? Array(stride(from: 24, through: 36, by: 2)) : Array(stride(from: 20, through: 80, by: 10))
for hue in hues {
  for saturation in saturations {
    if verify {
      try setBack(#"{"kelvin":2400,"brightness":10}"#, action: "simulated-cct")
      try capture.capture(directory.appendingPathComponent("simulated-2400.png"))
    } else {
      try setBack(
        #"{"hue":\#(hue),"saturation":\#(saturation),"brightness":10}"#,
        action: "hsi"
      )
      try capture.capture(directory.appendingPathComponent(String(format: "h%03d-s%03d.png", hue, saturation)))
    }
  }
}

session.stopRunning()
try runCurl("/overrides", body: #"{"targets":"all","minutes":0}"#)
try runCurl("/lights/back/auto-cct", body: #"{"kelvin":1000,"brightness":3}"#)
print(directory.path)
