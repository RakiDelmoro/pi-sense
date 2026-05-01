/// Evaluate a mathematical expression where `x` is replaced by `value`.
///
/// Examples:
/// - `x * 1.8 + 32` converts Celsius to Fahrenheit.
/// - `x / 1000` converts millivolts to volts.
/// - `(x - 32) / 1.8` converts Fahrenheit to Celsius.
pub fn evaluate_transform(expression: &str, value: f64) -> Option<f64> {
    let substituted = expression.replace('x', &value.to_string());
    match meval::eval_str(&substituted) {
        Ok(result) => Some(result),
        Err(e) => {
            log::warn!("Transform evaluation failed for '{}': {}", expression, e);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_celsius_to_fahrenheit() {
        assert_eq!(evaluate_transform("x * 1.8 + 32", 0.0), Some(32.0));
        assert_eq!(evaluate_transform("x * 1.8 + 32", 100.0), Some(212.0));
    }

    #[test]
    fn test_division() {
        assert_eq!(evaluate_transform("x / 1000", 5000.0), Some(5.0));
    }

    #[test]
    fn test_fahrenheit_to_celsius() {
        assert_eq!(evaluate_transform("(x - 32) / 1.8", 32.0), Some(0.0));
        assert_eq!(evaluate_transform("(x - 32) / 1.8", 212.0), Some(100.0));
    }

    #[test]
    fn test_sqrt() {
        let result = evaluate_transform("sqrt(x)", 16.0).unwrap();
        assert!((result - 4.0).abs() < 0.0001);
    }
}
