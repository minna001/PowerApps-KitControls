#!/bin/bash
# Installs the Power Platform toolchain on Ubuntu: .NET SDK 8 + 10 and the pac CLI.
# Idempotent. Run as root (or with sudo).
set -e
export DEBIAN_FRONTEND=noninteractive DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
apt-get update -qq || true
apt-get install -y -qq dotnet-sdk-8.0 dotnet-sdk-10.0
[ -x /usr/local/bin/pac ] || dotnet tool install --tool-path /usr/local/bin Microsoft.PowerApps.CLI.Tool
pac telemetry disable
pac help | sed -n 2p
