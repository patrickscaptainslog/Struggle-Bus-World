#!/bin/sh
# One command to tools/moon/hand.mjs: tools/moon/hand.sh '<body>' [port]
curl -s --max-time 590 -X POST --data-binary "$1" "http://127.0.0.1:${2:-4188}/"
