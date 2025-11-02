#!/bin/bash
# Create the test storage directory if it doesn't exist
mkdir -p .test-storage

# Run Jest tests
npx jest $@
