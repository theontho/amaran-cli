# Amaran WebSocket API - Missing Functionality

This document outlines the missing functionality in our WebSocket API implementation compared to the official OpenAPI spec. https://tools.sidus.link/openapi/docs/protocol 

Written by AI

## Missing Commands

### Device Management
- [ ] `get_preset_list` - Get list of available presets
- [ ] `get_system_effect_list` - Get list of available system effects
- [ ] `get_node_config` - Already implemented but could be enhanced with proper typing

### Scene Management
- [ ] `save_scene` - Save current light states as a scene
- [ ] `delete_scene` - Remove a saved scene
- [ ] `recall_scene` - Recall a saved scene
- [ ] `update_scene` - Update an existing scene

### Light Control (Enhancements)
- [ ] `set_effect` - Set custom effect (different from system effects)
- [ ] `set_effect_speed` - Control effect speed
- [ ] `set_effect_intensity` - Control effect intensity separately from light intensity
- [ ] `set_fan_mode` - Control fan settings if supported by the device
- [ ] `set_fan_speed` - Adjust fan speed if supported

### Group Management
- [ ] `create_group` - Create a new light group
- [ ] `delete_group` - Remove a light group
- [ ] `add_to_group` - Add device to a group
- [ ] `remove_from_group` - Remove device from a group
- [ ] `get_group_list` - List all groups

### Firmware & Device Info
- [ ] `get_device_info` - Get detailed device information
- [ ] `get_firmware_version` - Check firmware version
- [ ] `check_for_updates` - Check for firmware updates
- [ ] `update_firmware` - Initiate firmware update

## Implementation Notes

1. **Type Safety**:
   - [ ] Add proper TypeScript interfaces for all response types
   - [ ] Add input validation for all commands
   - [ ] Add proper error handling for unsupported operations

2. **Documentation**:
   - [ ] Add JSDoc comments for all public methods
   - [ ] Document return types and possible errors
   - [ ] Add usage examples for each command

3. **Testing**:
   - [ ] Add unit tests for all commands
   - [ ] Add integration tests with mock WebSocket server
   - [ ] Add error case testing

4. **Error Handling**:
   - [ ] Implement proper error codes and messages
   - [ ] Add retry logic for failed commands
   - [ ] Add timeout handling for commands

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

## Contributing

When implementing new features, please:
1. Follow the existing code style
2. Add appropriate TypeScript types
3. Include unit tests
4. Update the documentation
5. Submit a pull request with a clear description of the changes
