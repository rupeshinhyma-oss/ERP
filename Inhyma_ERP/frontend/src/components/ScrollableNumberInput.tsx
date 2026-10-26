import React, { useEffect, useRef, useCallback } from "react";

export interface ScrollableNumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: number | string;
  onChange: (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => void;
  minVal?: number;
  maxVal?: number;
  stepVal?: number;
}

/**
 * Number input that smoothly increments by 1 on scroll up and decrements by 1 on scroll down,
 * preventing accidental page scroll via non-passive native wheel listener.
 */
export function ScrollableNumberInput({
  value,
  onChange,
  minVal,
  maxVal,
  stepVal = 1,
  className,
  style,
  ...props
}: ScrollableNumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastStepTimeRef = useRef<number>(0);

  const stepValue = useCallback(
    (direction: 1 | -1) => {
      const current = parseFloat(String(value));
      const base = isNaN(current) ? (minVal ?? 0) : current;
      let next = base + direction * stepVal;

      if (minVal !== undefined && next < minVal) {
        next = minVal;
      }
      if (maxVal !== undefined && next > maxVal) {
        next = maxVal;
      }

      next = Math.round(next * 100) / 100;
      onChange({ target: { value: String(next) } } as any);
    },
    [value, minVal, maxVal, stepVal, onChange]
  );

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      (e as any).__scrollableHandled = true;

      const now = Date.now();
      if (e.isTrusted && now - lastStepTimeRef.current < 50) return;
      lastStepTimeRef.current = now;

      if (e.deltaY < 0) {
        stepValue(1);
      } else if (e.deltaY > 0) {
        stepValue(-1);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
    };
  }, [stepValue]);

  const handleSyntheticWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    if ((e.nativeEvent as any)?.__scrollableHandled) return;

    const now = Date.now();
    if (e.isTrusted && now - lastStepTimeRef.current < 50) return;
    lastStepTimeRef.current = now;

    if (e.deltaY < 0) {
      stepValue(1);
    } else if (e.deltaY > 0) {
      stepValue(-1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      stepValue(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      stepValue(-1);
    }
    props.onKeyDown?.(e);
  };

  return (
    <input
      ref={inputRef}
      type="number"
      step="any"
      value={value}
      onChange={(e) => onChange(e)}
      onWheel={handleSyntheticWheel}
      onKeyDown={handleKeyDown}
      className={className}
      style={style}
      {...props}
    />
  );
}
