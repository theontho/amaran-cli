#!/bin/bash
# Create the test storage directory if it doesn't exist
mkdir -p .test-storage

# Run tests with the local storage file path
export NODE_OPTIONS="--localstorage-file=$(pwd)/.test-storage/localstorage.json"

# Run Jest tests
npx jest $@
