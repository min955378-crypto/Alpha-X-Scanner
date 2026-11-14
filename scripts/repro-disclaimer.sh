#!/usr/bin/env bash
# Reproduce the exact client sequence the browser performs:
#   login -> session -> POST disclaimer -> session (x2)
set -u
BASE=http://127.0.0.1:3000
JAR=$(mktemp)
USER=${1:-admin}; PASS=${2:-AlphaX@2026}; KEY=${3:-APS-9F4A-22C1-88E0}

j() { python3 -c "import json,sys;d=json.load(sys.stdin);u=d.get('user');print('   user=',(u['username'] if u else None),'acceptedDisclaimerAt=',(u.get('acceptedDisclaimerAt') if u else 'NO USER'))"; }

echo "1) POST /api/auth/login  ($USER)"
curl -s -c "$JAR" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\",\"licenseKey\":\"$KEY\"}" | j

echo "2) GET  /api/auth/session   (before)"
curl -s -b "$JAR" "$BASE/api/auth/session" | j

echo "3) POST /api/user/disclaimer"
echo -n "   http="; curl -s -o /tmp/disc.txt -w "%{http_code}\n" -b "$JAR" -X POST "$BASE/api/user/disclaimer"; cat /tmp/disc.txt; echo

echo "4) GET  /api/auth/session   (after — should show a timestamp)"
curl -s -b "$JAR" "$BASE/api/auth/session" | j

echo "5) GET  /api/auth/session   (again — must be stable)"
curl -s -b "$JAR" "$BASE/api/auth/session" | j

rm -f "$JAR"
