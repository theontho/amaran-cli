# API Reference

This document is a compact version of the API documentation extracted from the local HTML dump.  We copied the html from the browser inspector and then used the `scripts/extract-api.ts` script to convert the html to AI friendly markdown.  This will help if there are API updates in the future to implement.  From https://tools.sidus.link/openapi/docs/protocol

## get_protocol_versions

> Get supported protocol versions

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "action": "get_protocol_versions",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "action": "get_protocol_versions",
  "data": [
    2
  ]
}
```

## get_node_config

> Get node configuration

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_node_config",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_node_config",
  "data": {
    "cct_support": true,
    "cct_min": 2000,
    "cct_max": 10000,
    "cct_extension_support": false,
    "cct_extension_min": 1800,
    "cct_extension_max": 20000,
    "cct_extension_enabled": false,
    "gm_support": true,
    "gm_min": 0,
    "gm_max": 200,
    "gm_v2_support": true,
    "hsi_support": true,
    "rgb_support": true,
    "advanced_hsi_support": false
  }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| cct_support | boolean | Yes | Whether CCT is supported |
| cct_min | integer | Yes | Minimum CCT value |
| cct_max | integer | Yes | Maximum CCT value |
| cct_extension_support | boolean | Yes | Whether CCT extension is supported |
| cct_extension_min | integer | Yes | Minimum CCT extension value |
| cct_extension_max | integer | Yes | Maximum CCT extension value |
| cct_extension_enabled | boolean | Yes | Whether CCT extension is enabled |
| gm_support | boolean | Yes | Whether GM is supported |
| gm_min | integer | Yes | Minimum GM value |
| gm_max | integer | Yes | Maximum GM value |
| gm_v2_support | boolean | Yes | Whether ±G is supported |
| hsi_support | boolean | Yes | Whether HSI is supported |
| rgb_support | boolean | Yes | Whether RGB is supported |
| advanced_hsi_support | boolean | Yes | Whether advanced HSI is supported |


## get_fixture_list

> Get device list, excluding groups

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "action": "get_fixture_list",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "action": "get_fixture_list",
  "data": [
    {
      "id": "05005-ccdde2",
      "name": "MC - 2",
      "node_id": "05005-ccdde2"
    },
    {
      "id": "05010-ccdde1",
      "name": "MC Pro - 1",
      "node_id": "05010-ccdde1"
    }
  ]
}
```

## get_device_list

> Get device list, including groups

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "action": "get_device_list",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "action": "get_device_list",
  "data": [
    {
      "id": "05005-ccdde2",
      "name": "MC - 2",
      "node_id": "05005-ccdde2"
    },
    {
      "id": "05010-ccdde1",
      "name": "MC Pro - 1",
      "node_id": "05010-ccdde1"
    },
    {
      "id": "00000000000000000000000000000000",
      "name": "ALL",
      "node_id": "00000000000000000000000000000000"
    }
  ]
}
```

## get_scene_list

> Get scene list

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "action": "get_scene_list",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "action": "get_scene_list",
  "data": [
    {
      "id": "ccd8e2fec75111efa2039e338d4af4c7",
      "name": "Scene 01",
      "fixtures": [
        {
          "id": "05005-ccdde2",
          "name": "MC - 2",
          "node_id": "05005-ccdde2"
        },
        {
          "id": "05010-ccdde1",
          "name": "MC Pro - 1",
          "node_id": "05010-ccdde1"
        }
      ],
      "groups": [
        {
          "id": "ccd91620c75111efa2039e338d4af4c7",
          "name": "All",
          "node_id": "ccd91620c75111efa2039e338d4af4c7"
        }
      ]
    }
  ]
}
```

## get_sleep

> Get sleep

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_sleep",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_sleep",
  "data": false
}
```

## set_sleep

> Set sleep

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_sleep",
  "args": {
    "sleep": true
  },
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| sleep | boolean | Yes | Sleep state |


### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_sleep",
  "data": true
}
```

## toggle_sleep

> Toggle sleep

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "toggle_sleep",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "toggle_sleep",
  "data": false
}
```

## get_intensity

> Get intensity

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_intensity",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_intensity",
  "data": 500
}
```

## set_intensity

> Set intensity

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_intensity",
  "args": {
    "intensity": 500
  },
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| intensity | integer | Yes | Range [0, 1000], 1000 represents 100% |


### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_intensity",
  "data": 500
}
```

## increase_intensity

> Increase intensity

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "increase_intensity",
  "args": {
    "delta": 10
  },
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| delta | integer | Yes | intensity += delta |


### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "increase_intensity",
  "data": 510
}
```

## get_cct

> Get CCT

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_cct",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_cct",
  "data": {
    "cct": 2000,
    "intensity": 510,
    "gm": 100
  }
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| cct | integer | Yes | 5000 represents 5000K |
| gm | integer | No | If supported by the device, this field is returned, range [0, 200], 90: M0.1, 100: 0, 110: G0.1 or 90: -10%, 100: 0%, 110: 10% |
| intensity | integer | Yes | Range [0, 1000], 1000 represents 100% |


## set_cct

> Set CCT

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_cct",
  "args": {
    "cct": 5000
  },
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| cct | integer | Yes | 5000 represents 5000K |
| gm | integer | No | The field is returned in the response if the device supports it, range [0, 200], 90: M0.1, 100: 0, 110: G0.1 or 90: -10%, 100: 0%, 110: 10% |
| intensity | integer | No | Range [0, 1000], 1000 represents 100% |


### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_cct",
  "data": {
    "cct": 5000,
    "intensity": 510,
    "gm": 100
  }
}
```

## increase_cct

> Increase CCT

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "increase_cct",
  "args": {
    "delta": 10
  },
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| delta | integer | Yes | cct += delta |


### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "increase_cct",
  "data": {
    "cct": 5010,
    "intensity": 510,
    "gm": 100
  }
}
```

## get_hsi

> Get HSI

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_hsi",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_hsi",
  "data": {
    "hue": 100,
    "sat": 50,
    "intensity": 510
  }
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| hue | integer | Yes | Range [0, 360] |
| sat | integer | Yes | Range [0, 100] |
| intensity | integer | Yes | Range [0, 1000], 1000 represents 100% |
| cct | integer | No | If supported by the device, this field is returned, 5000 represents 5000K |
| gm | integer | No | If supported by the device, this field is returned, range [0, 200], 90: M0.1, 100: 0, 110: G0.1 or 90: -10%, 100: 0%, 110: 10% |


## set_hsi

> Set HSI

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_hsi",
  "args": {
    "hue": 100,
    "sat": 50,
    "intensity": 500
  },
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| hue | integer | Yes | Range [0, 360] |
| sat | integer | Yes | Range [0, 100] |
| intensity | integer | Yes | Range [0, 1000], 1000 represents 100% |
| cct | integer | No | The field is returned in the response if the device supports it, 5000 represents 5000K |
| gm | integer | No | The field is returned in the response if the device supports it, range [0, 200], 90: M0.1, 100: 0, 110: G0.1 or 90: -10%, 100: 0%, 110: 10% |


### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_hsi",
  "data": {
    "hue": 100,
    "sat": 50,
    "intensity": 500
  }
}
```

## get_rgb

> Get RGB

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_rgb",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_rgb",
  "data": {
    "r": 255,
    "g": 255,
    "b": 255,
    "intensity": 500
  }
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| r | integer | Yes | Range [0, 255] |
| g | integer | Yes | Range [0, 255] |
| b | integer | Yes | Range [0, 255] |
| intensity | integer | Yes | Range [0, 1000], 1000 represents 100% |


## set_rgb

> Set RGB

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_rgb",
  "args": {
    "r": 255,
    "g": 255,
    "b": 255
  },
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| r | integer | Yes | Range [0, 255] |
| g | integer | Yes | Range [0, 255] |
| b | integer | Yes | Range [0, 255] |
| intensity | integer | No | Range [0, 1000], 1000 represents 100% |


### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_rgb",
  "data": {
    "r": 255,
    "g": 255,
    "b": 255,
    "intensity": 500
  }
}
```

## get_system_effect_list

> Get system effect list

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_system_effect_list",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "get_system_effect_list",
  "data": [
    "paparazzi",
    "fireworks",
    "fault_bulb",
    "lightning",
    "tv",
    "pulsing",
    "strobe",
    "explosion",
    "club_lights",
    "candle",
    "fire",
    "welding",
    "cop_car",
    "color_chase",
    "party_lights",
    "fault_bulb2",
    "lightning2",
    "tv2",
    "pulsing2",
    "strobe2",
    "explosion2",
    "fire2",
    "welding2"
  ]
}
```

## set_system_effect

> Set system effect

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_system_effect",
  "args": {
    "effect_type": "paparazzi"
  },
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| effect_type | string | Yes | Effect type |


### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_system_effect",
  "data": "paparazzi"
}
```

## get_quickshot_list

> Get quickshot list

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "action": "get_quickshot_list",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "action": "get_quickshot_list",
  "data": [
    {
      "id": "00b7bc80c75211efa2039e338d4af4c7",
      "name": "Shortcut 01",
      "scene_id": null
    }
  ]
}
```

## set_quickshot

> Set quickshot

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "action": "set_quickshot",
  "args": {
    "quickshot_id": "00b7bc80c75211efa2039e338d4af4c7"
  },
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| quickshot_id | string | Yes | quickshot ID |


### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "action": "set_quickshot",
  "data": "00b7bc80c75211efa2039e338d4af4c7"
}
```

## get_preset_list

> Get preset list

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "action": "get_preset_list",
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "action": "get_preset_list",
  "data": {
    "cct": [
      {
        "id": "c045f822c74e11efa2039e338d4af4c7",
        "category": "cct",
        "name": "CCT 00"
      }
    ],
    "color": [
      {
        "id": "c045f89ac74e11efa2039e338d4af4c7",
        "category": "color",
        "name": "Color 00"
      }
    ],
    "effect": [
      {
        "id": "c045f8b8c74e11efa2039e338d4af4c7",
        "category": "effect",
        "name": "Effect 01"
      }
    ]
  }
}
```

## set_preset

> Set preset

### Request

```json
{
  "version": 2,
  "type": "request",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_preset",
  "args": {
    "preset_id": "c045f822c74e11efa2039e338d4af4c7"
  },
  "token": "uQfRj0LSWbTE5se4uGN4bCRTHPMahBOCN2Rz0vNxTvStqhi39yA="
}
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| preset_id | string | Yes | Preset ID |


### Response

```json
{
  "code": 0,
  "message": "ok",
  "version": 2,
  "type": "response",
  "client_id": 1,
  "request_id": 123,
  "node_id": "05010-ccdde1",
  "action": "set_preset",
  "data": "c045f822c74e11efa2039e338d4af4c7"
}
```

