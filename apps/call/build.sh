#!/bin/sh
# Build call-ears and put it on the path. One file, no packages.
set -eu
cd "$(dirname "$0")"
mkdir -p .build
swiftc -O -o .build/call-ears ears.swift
install -d "$HOME/.local/bin"
install .build/call-ears "$HOME/.local/bin/call-ears"
echo "installed $HOME/.local/bin/call-ears"
