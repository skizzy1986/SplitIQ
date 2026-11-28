//! Wire formats for the seat sensor's BLE service, protocol version 1.
//!
//! `hardware/seat-sensor/docs/ble-protocol.md` is the spec. Until the Rust
//! firmware replaces the C++ one, `firmware/src/protocol.h` is the source of
//! truth and this crate follows it: a layout change edits all three and bumps
//! [`PROTOCOL_VERSION`]. The spec's test vector is pinned in all three.
//!
//! The C++ side gets its byte layout from packed structs on a little-endian
//! CPU. Here every field is encoded explicitly with `to_le_bytes`, so the
//! layout holds on any host and is visible in the code, not implied by the
//! compiler.
#![cfg_attr(not(test), no_std)]

pub mod scaling;

pub const PROTOCOL_VERSION: u8 = 1;

pub const SERVICE_UUID: &str = "36f90001-f6b6-4908-857c-004314d7acba";
pub const SAMPLES_UUID: &str = "36f90002-f6b6-4908-857c-004314d7acba";
pub const STATUS_UUID: &str = "36f90003-f6b6-4908-857c-004314d7acba";
pub const INFO_UUID: &str = "36f90004-f6b6-4908-857c-004314d7acba";
pub const CONTROL_UUID: &str = "36f90005-f6b6-4908-857c-004314d7acba";

pub const SAMPLES_PER_PACKET: usize = 8;
pub const SAMPLE_PERIOD_US: u16 = 5000;

fn u16_at(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}

fn i16_at(b: &[u8], o: usize) -> i16 {
    i16::from_le_bytes([b[o], b[o + 1]])
}

fn u32_at(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

/// Samples characteristic (notify), 20 bytes: fits the default 23-byte ATT MTU.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SamplePacket {
    /// Device time of sample 0 in µs, the low 32 bits of `esp_timer` (wraps every 71.6 min).
    pub t0_us: u32,
    /// Position in 0.1 mm; sample k was taken at `t0_us + k * SAMPLE_PERIOD_US`.
    pub pos_01mm: [i16; SAMPLES_PER_PACKET],
}

impl SamplePacket {
    pub const SIZE: usize = 20;

    pub fn to_bytes(&self) -> [u8; Self::SIZE] {
        let mut b = [0u8; Self::SIZE];
        b[0..4].copy_from_slice(&self.t0_us.to_le_bytes());
        for (k, pos) in self.pos_01mm.iter().enumerate() {
            let o = 4 + 2 * k;
            b[o..o + 2].copy_from_slice(&pos.to_le_bytes());
        }
        b
    }

    pub fn from_bytes(b: &[u8; Self::SIZE]) -> Self {
        Self {
            t0_us: u32_at(b, 0),
            pos_01mm: core::array::from_fn(|k| i16_at(b, 4 + 2 * k)),
        }
    }
}

/// Status flag bits. Bits 6–7 are reserved and stay 0.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StatusFlags(pub u8);

impl StatusFlags {
    /// Position is referenced to the home index; absolute position is meaningless when clear.
    pub const HOMED: Self = Self(1 << 0);
    /// A client is subscribed to samples.
    pub const STREAMING: Self = Self(1 << 1);
    /// The seat moved more than 1 mm in the last second.
    pub const MOVING: Self = Self(1 << 2);
    /// The last re-index pass disagreed by more than 2 mm (latched until re-homed).
    pub const SLIP: Self = Self(1 << 3);
    /// Battery under 15 %.
    pub const BATT_LOW: Self = Self(1 << 4);
    /// A sample packet was dropped on the device (latched until reconnect).
    pub const OVERRUN: Self = Self(1 << 5);

    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
}

impl core::ops::BitOr for StatusFlags {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

/// Status characteristic (read, notify), 10 bytes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StatusPacket {
    pub flags: StatusFlags,
    /// 0–100; `0xFF` = not measured.
    pub battery_pct: u8,
    /// 0 = not measured.
    pub battery_mv: u16,
    /// Position error found at the last re-index pass, in 0.1 mm.
    pub last_reindex_err_01mm: i16,
    /// Packets dropped on the device since the client subscribed.
    pub dropped_packets: u16,
    /// Peak channel-A frequency over the last second, ÷10 (encoder headroom).
    pub peak_rate_hz_div10: u16,
}

impl StatusPacket {
    pub const SIZE: usize = 10;

    pub fn to_bytes(&self) -> [u8; Self::SIZE] {
        let mut b = [0u8; Self::SIZE];
        b[0] = self.flags.0;
        b[1] = self.battery_pct;
        b[2..4].copy_from_slice(&self.battery_mv.to_le_bytes());
        b[4..6].copy_from_slice(&self.last_reindex_err_01mm.to_le_bytes());
        b[6..8].copy_from_slice(&self.dropped_packets.to_le_bytes());
        b[8..10].copy_from_slice(&self.peak_rate_hz_div10.to_le_bytes());
        b
    }

    pub fn from_bytes(b: &[u8; Self::SIZE]) -> Self {
        Self {
            flags: StatusFlags(b[0]),
            battery_pct: b[1],
            battery_mv: u16_at(b, 2),
            last_reindex_err_01mm: i16_at(b, 4),
            dropped_packets: u16_at(b, 6),
            peak_rate_hz_div10: u16_at(b, 8),
        }
    }
}

/// Info characteristic (read once), 14 bytes. Byte 7 is reserved and written as 0.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct InfoPacket {
    pub protocol_version: u8,
    pub fw_major: u8,
    pub fw_minor: u8,
    pub fw_patch: u8,
    pub sample_period_us: u16,
    pub samples_per_packet: u8,
    /// Calibration in use; counts per mm = 1e6 / `nm_per_count`.
    pub nm_per_count: u32,
    /// Position assigned at the home index.
    pub home_pos_01mm: i16,
}

impl InfoPacket {
    pub const SIZE: usize = 14;

    pub fn to_bytes(&self) -> [u8; Self::SIZE] {
        let mut b = [0u8; Self::SIZE];
        b[0] = self.protocol_version;
        b[1] = self.fw_major;
        b[2] = self.fw_minor;
        b[3] = self.fw_patch;
        b[4..6].copy_from_slice(&self.sample_period_us.to_le_bytes());
        b[6] = self.samples_per_packet;
        b[8..12].copy_from_slice(&self.nm_per_count.to_le_bytes());
        b[12..14].copy_from_slice(&self.home_pos_01mm.to_le_bytes());
        b
    }

    pub fn from_bytes(b: &[u8; Self::SIZE]) -> Self {
        Self {
            protocol_version: b[0],
            fw_major: b[1],
            fw_minor: b[2],
            fw_patch: b[3],
            sample_period_us: u16_at(b, 4),
            samples_per_packet: b[6],
            nm_per_count: u32_at(b, 8),
            home_pos_01mm: i16_at(b, 12),
        }
    }
}

/// Control characteristic opcodes (1 byte, write with response).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum ControlOp {
    /// Take the current position as home (manual reference, no reed).
    HomeHere = 0x01,
    /// Drop the reference; the next reed pass homes again.
    ClearHome = 0x02,
    /// Disconnect and enter deep sleep.
    Sleep = 0x03,
}

impl ControlOp {
    /// `None` for an unknown opcode, which the spec says the device ignores.
    pub const fn from_byte(b: u8) -> Option<Self> {
        match b {
            0x01 => Some(Self::HomeHere),
            0x02 => Some(Self::ClearHome),
            0x03 => Some(Self::Sleep),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ble-protocol.md "Test vector"; host_test.cpp pins the same bytes.
    const SPEC_VECTOR: [u8; 20] = [
        0x01, 0x02, 0x03, 0x04, 0xFE, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0xD2, 0x04,
    ];

    #[test]
    fn sample_packet_decodes_the_spec_vector() {
        let p = SamplePacket::from_bytes(&SPEC_VECTOR);
        assert_eq!(p.t0_us, 67_305_985);
        assert_eq!(p.pos_01mm, [-2, 0, 0, 0, 0, 0, 0, 1234]);
    }

    #[test]
    fn sample_packet_encodes_the_spec_vector() {
        let p = SamplePacket {
            t0_us: 0x0403_0201,
            pos_01mm: [-2, 0, 0, 0, 0, 0, 0, 1234],
        };
        assert_eq!(p.to_bytes(), SPEC_VECTOR);
    }

    #[test]
    fn a_slice_of_the_wrong_length_is_refused_not_misread() {
        let short: &[u8] = &SPEC_VECTOR[..19];
        let as_array: Result<&[u8; 20], _> = short.try_into();
        assert!(as_array.is_err());
    }

    #[test]
    fn status_packet_matches_the_spec_offsets() {
        let s = StatusPacket {
            flags: StatusFlags::HOMED | StatusFlags::SLIP,
            battery_pct: 0xFF,
            battery_mv: 0x0201,
            last_reindex_err_01mm: -3,
            dropped_packets: 0x0605,
            peak_rate_hz_div10: 0x0807,
        };
        let b = s.to_bytes();
        assert_eq!(
            b,
            [0x09, 0xFF, 0x01, 0x02, 0xFD, 0xFF, 0x05, 0x06, 0x07, 0x08]
        );
        assert_eq!(StatusPacket::from_bytes(&b), s);
    }

    #[test]
    fn status_flags_are_the_spec_bits() {
        let all = [
            StatusFlags::HOMED,
            StatusFlags::STREAMING,
            StatusFlags::MOVING,
            StatusFlags::SLIP,
            StatusFlags::BATT_LOW,
            StatusFlags::OVERRUN,
        ];
        for (bit, flag) in all.iter().enumerate() {
            assert_eq!(flag.0, 1 << bit);
        }
        let f = StatusFlags::HOMED | StatusFlags::MOVING;
        assert!(f.contains(StatusFlags::HOMED));
        assert!(!f.contains(StatusFlags::SLIP));
    }

    #[test]
    fn info_packet_matches_the_spec_offsets() {
        let i = InfoPacket {
            protocol_version: PROTOCOL_VERSION,
            fw_major: 0,
            fw_minor: 1,
            fw_patch: 0,
            sample_period_us: SAMPLE_PERIOD_US,
            samples_per_packet: SAMPLES_PER_PACKET as u8,
            nm_per_count: 40_000,
            home_pos_01mm: -1,
        };
        let b = i.to_bytes();
        assert_eq!(
            b,
            [
                0x01, 0x00, 0x01, 0x00, 0x88, 0x13, 0x08, 0x00, 0x40, 0x9C, 0x00, 0x00, 0xFF, 0xFF
            ]
        );
        assert_eq!(InfoPacket::from_bytes(&b), i);
    }

    #[test]
    fn info_packet_reserved_byte_is_written_as_zero() {
        let mut b = InfoPacket::default().to_bytes();
        assert_eq!(b[7], 0);
        // A non-zero reserved byte from a future firmware still decodes.
        b[7] = 0xAA;
        assert_eq!(InfoPacket::from_bytes(&b), InfoPacket::default());
    }

    #[test]
    fn control_opcodes_round_trip_and_unknown_ones_are_none() {
        for op in [ControlOp::HomeHere, ControlOp::ClearHome, ControlOp::Sleep] {
            assert_eq!(ControlOp::from_byte(op as u8), Some(op));
        }
        assert_eq!(ControlOp::from_byte(0x00), None);
        assert_eq!(ControlOp::from_byte(0x04), None);
    }

    #[test]
    fn uuids_share_the_spec_base() {
        for (n, uuid) in [
            SERVICE_UUID,
            SAMPLES_UUID,
            STATUS_UUID,
            INFO_UUID,
            CONTROL_UUID,
        ]
        .iter()
        .enumerate()
        {
            assert_eq!(uuid.len(), 36);
            assert_eq!(&uuid[..8], format!("36f9000{}", n + 1));
            assert!(uuid.ends_with("-f6b6-4908-857c-004314d7acba"));
        }
    }
}
