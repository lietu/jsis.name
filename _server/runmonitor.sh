#!/bin/bash

# Load NVM
. ~/.nvm/nvm.sh

# Override PATH
PATH="${PATH}:~/bin"

# Figure out where we are
dir=$(dirname "${0}")

# Fix working directory
cd "${dir}"

# Run monitor
./monitor.sh > /dev/null
