#!/bin/bash
set -e
cd "`dirname $0`"/../airdrop-contract
cargo build --all --target wasm32-unknown-unknown --release
cd ..
cp airdrop-contract/target/wasm32-unknown-unknown/release/*.wasm ./res/
