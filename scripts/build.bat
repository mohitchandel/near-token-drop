@echo off

title token_distribution build
cd ..
cargo build --all --target wasm32-unknown-unknown --release
xcopy %CD%\target\wasm32-unknown-unknown\release\*.wasm %CD%\res /Y
pause