#!/bin/bash
set -e

pnpm install
pnpm db:migrate
