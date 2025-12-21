# Amaran WebSocket API - Missing Functionality

This document outlines the missing functionality in our WebSocket API implementation compared to the official OpenAPI spec. https://tools.sidus.link/openapi/docs/protocol 

Written by AI

## Missing Commands

### Device Management
- [x] `get_preset_list` - Get list of available presets
- [x] `get_system_effect_list` - Get list of available system effects
- [x] `get_node_config` - Implemented and used for initialization
- [x] `get_device_list` - Implemented and used for initialization
- [x] `get_scene_list` - Implemented and used for initialization
- [x] `get_fixture_list` - Get simple list of fixtures

### Scene Management
- [x] `save_scene` - Save current light states as a scene
- [x] `delete_scene` - Remove a saved scene
- [x] `recall_scene` - Recall a saved scene
- [x] `update_scene` - Update an existing scene

### Light Control (Implemented & Enhancements)
- [x] `set_intensity` / `increment_intensity`
- [x] `set_cct` / `increment_cct`
- [x] `set_hsi`
- [x] `set_color`
- [x] `set_system_effect` - Set system effect (predefined)
- [x] `set_effect` - Set custom effect
- [x] `set_effect_speed` - Control effect speed
- [x] `set_effect_intensity` - Control effect intensity
- [x] `set_fan_mode` - Control fan settings
- [x] `set_fan_speed` - Adjust fan speed

### Group Management
- [x] `create_group` - Create a new light group
- [x] `delete_group` - Remove a light group
- [x] `add_to_group` - Add device to a group
- [x] `remove_from_group` - Remove device from a group
- [x] `get_group_list` - List all groups

### Firmware & Device Info
- [x] `get_device_info` - Get detailed device information
- [x] `get_firmware_version` - Check firmware version
- [x] `check_for_updates` - Check for firmware updates
- [x] `update_firmware` - Initiate firmware update
- [x] `get_protocol_versions` - Get supported protocol versions
- [x] `get_quickshot_list` - Get list of quickshots
- [x] `set_quickshot` - Set a quickshot

## Implementation Notes

1. **Type Safety**:
   - [x] Add proper TypeScript interfaces for all response types
   - [x] Add input validation for all commands
   - [x] Add proper error handling for unsupported operations

2. **Documentation**:
   - [x] Add JSDoc comments for all public methods
   - [x] Document return types and possible errors
   - [x] Add usage examples for each command (In README and CLI help)

3. **Testing**:
   - [x] Add unit tests for all commands
   - [x] Add integration tests with mock WebSocket server
   - [x] Add error case testing

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

## Contributing

When implementing new features, please:
1. Follow the existing code style
2. Add appropriate TypeScript types
3. Include unit tests
4. Update the documentation
5. Submit a pull request with a clear description of the changes
