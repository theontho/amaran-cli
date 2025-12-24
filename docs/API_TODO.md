# Amaran WebSocket API - Missing Functionality

This document outlines the missing functionality in our WebSocket API implementation compared to the official OpenAPI spec. https://tools.sidus.link/openapi/docs/protocol 

Written by AI

## Implementation Notes

4. **Error Handling**:
   - [/] Implement proper error codes and messages (Partially complete)
   - [ ] Add retry logic for failed commands
   - [x] Add timeout handling for commands (Implemented in `disconnect` and utility functions)

## Known Limitations

1. The current implementation assumes all lights support all commands. Some commands may not be available on all devices.
2. Error handling could be more robust, especially for network-related issues.
3. Some commands may require additional parameters that aren't currently exposed in the API.

## Future Enhancements

1. **Event System**:
   - [ ] Implement event listeners for device state changes
   - [ ] Add support for real-time updates

2. **Advanced Controls**:
   - [ ] Add support for color palettes
   - [ ] Implement color temperature presets
   - [ ] Add support for custom effects

3. **Performance**:
   - [ ] Implement command batching for multiple operations
   - [ ] Add request/response correlation for better debugging
   - [ ] Implement connection pooling for multiple devices
