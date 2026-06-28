#!/bin/bash
cd "$(dirname "$0")" || exit 1
exec ./stop-all.sh
