#!/bin/bash
if [ -z "$1" ]; then
   echo "You must specify a workflow ID"
   exit 1
fi
# source ../../setclaimcheck.sh
source ../../setcloudenv.sh
npm run compliance.approval -- --workflow-id $1
