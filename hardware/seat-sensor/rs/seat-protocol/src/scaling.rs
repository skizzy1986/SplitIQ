//! Counts to position, the Rust port of `firmware/src/scaling.h`.

/// Which way the encoder counts relative to the spec's sign convention
/// (positive away from the flywheel). An enum, not the C++ `int8_t`, so a
/// direction other than ±1 cannot be stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Forward,
    Reverse,
}

impl Direction {
    const fn sign(self) -> i64 {
        match self {
            Self::Forward => 1,
            Self::Reverse => -1,
        }
    }
}

/// position (0.1 mm) = home_pos + direction × (count − home_count) × nm_per_count / 1e5,
/// truncated toward zero and saturated to i16 (±3276.7 mm, far beyond any erg rail).
pub fn counts_to_pos_01mm(
    count: i32,
    home_count: i32,
    nm_per_count: u32,
    direction: Direction,
    home_pos_01mm: i16,
) -> i16 {
    // Widen before subtracting, and saturate the product: the C++ original
    // subtracts in 32 bits first, and both steps can overflow at extreme
    // inputs. Rust panics on overflow in a debug build, so these are written
    // to saturate instead; the clamp below then gives the same answer as any
    // other out-of-range position.
    let delta = i64::from(count) - i64::from(home_count);
    let d01 = delta.saturating_mul(i64::from(nm_per_count)) / 100_000;
    let pos = i64::from(home_pos_01mm) + direction.sign() * d01;
    pos.clamp(i64::from(i16::MIN), i64::from(i16::MAX)) as i16
}

#[cfg(test)]
mod tests {
    use super::Direction::{Forward, Reverse};
    use super::*;

    // 20T GT2 pulley, 500 PPR encoder, 2x decoding: 25 counts per mm.
    const NM: u32 = 40_000;

    // The same cases as host_test.cpp, in the same order.
    #[test]
    fn one_mm_is_25_counts() {
        assert_eq!(counts_to_pos_01mm(25, 0, NM, Forward, 0), 10);
    }

    #[test]
    fn counts_past_the_16_bit_pcnt_limit_still_scale() {
        assert_eq!(counts_to_pos_01mm(25_000, 0, NM, Forward, 0), 10_000);
        assert_eq!(counts_to_pos_01mm(40_000, 0, NM, Forward, 0), 16_000);
    }

    #[test]
    fn home_offset_and_direction() {
        assert_eq!(counts_to_pos_01mm(1000, 1250, NM, Forward, 0), -100);
        assert_eq!(counts_to_pos_01mm(1000, 1250, NM, Reverse, 0), 100);
        assert_eq!(counts_to_pos_01mm(1250, 1250, NM, Forward, 123), 123);
    }

    #[test]
    fn sub_tenth_mm_truncates_toward_zero() {
        assert_eq!(counts_to_pos_01mm(2, 0, NM, Forward, 0), 0);
        assert_eq!(counts_to_pos_01mm(3, 0, NM, Forward, 0), 1);
        assert_eq!(counts_to_pos_01mm(-3, 0, NM, Forward, 0), -1);
    }

    #[test]
    fn saturates_at_the_i16_limits() {
        assert_eq!(counts_to_pos_01mm(10_000_000, 0, NM, Forward, 0), i16::MAX);
        assert_eq!(counts_to_pos_01mm(-10_000_000, 0, NM, Forward, 0), i16::MIN);
    }

    // Not in host_test.cpp: inputs where the C++ arithmetic overflows.
    #[test]
    fn extreme_inputs_saturate_instead_of_overflowing() {
        assert_eq!(
            counts_to_pos_01mm(i32::MAX, i32::MIN, u32::MAX, Forward, 0),
            i16::MAX
        );
        assert_eq!(
            counts_to_pos_01mm(i32::MIN, i32::MAX, u32::MAX, Forward, 0),
            i16::MIN
        );
        assert_eq!(
            counts_to_pos_01mm(i32::MAX, i32::MIN, u32::MAX, Reverse, 0),
            i16::MIN
        );
    }
}
