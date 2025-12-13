#!/bin/bash
# Create the test storage directory if it doesn't exist
mkdir -p .test-storage

# Run Vitest
npx vitest run $@
