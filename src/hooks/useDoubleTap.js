import { useCallback, useRef } from "react";

export default function useDoubleTap(onDoubleTap, delay = 300) {
  const lastTapRef = useRef(0);

  const handleDoubleClick = useCallback((event) => {
    onDoubleTap?.(event);
  }, [onDoubleTap]);

  const handleTouchEnd = useCallback((event) => {
    const now = Date.now();
    if (now - lastTapRef.current < delay) {
      event.preventDefault();
      onDoubleTap?.(event);
    }
    lastTapRef.current = now;
  }, [delay, onDoubleTap]);

  return {
    onDoubleClick: handleDoubleClick,
    onTouchEnd: handleTouchEnd,
  };
}