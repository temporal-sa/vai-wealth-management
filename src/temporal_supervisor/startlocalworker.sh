#!/bin/bash
source ../../setllmkey.sh
source ../../setclaimcheck.sh
source ../../setsplitworkflows.sh "$1"
npm run temporal:worker
