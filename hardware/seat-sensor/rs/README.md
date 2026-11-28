# Seat sensor, Rust

The Rust port of the seat-sensor firmware, tracked by epic #842 (decision D34:
Rust is the target language for SplitIQ device firmware). The C++ firmware in
`../firmware/` (#737) ships first and is the reference until #847 replaces it.

| Crate | What | Slice |
|---|---|---|
| `seat-protocol/` | Protocol version 1 wire formats and count scaling. `no_std`, no dependencies, host-tested | #843 |
| `firmware/` | ESP32-S3 firmware (not yet) | #844–#847 |

## Run the checks

From `seat-protocol/`. `rust-toolchain.toml` pins the toolchain, and rustup
installs it on first use:

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --release --target riscv32imc-unknown-none-elf   # proves no_std
```

CI runs the same commands (`.github/workflows/ci-hardware.yml`).

## The contract

`../docs/ble-protocol.md` is the spec. Until #847 merges, `../firmware/src/protocol.h`
is the source of truth and `seat-protocol` follows it. A layout change edits all
three and bumps `PROTOCOL_VERSION`. The spec's test vector is pinned in the C++ host
test and in `seat-protocol`'s tests.
