import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Lightweight pull-to-refresh for mobile: when at top and pulling down ~70px, triggers onRefresh
export default function PullToRefresh({ onRefresh }) {
  const startY = useRef(0);
  const pulling = useRef(false);
  const [distance, setDistance] = useState(0);
  const threshold = 70;

  useEffect(() => {
    const onTouchStart = (e) => {
      if (window.scrollY <= 0) {
        pulling.current = true;
        startY.current = e.touches[0].clientY;
      } else {
        pulling.current = false;
      }
    };

    const onTouchMove = (e) => {
      if (!pulling.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0) {
        e.preventDefault();
        setDistance(Math.min(dy, 120));
      }
    };

    const onTouchEnd = async () => {
      if (distance >= threshold) {
        setDistance(0);
        await onRefresh?.();
      }
      pulling.current = false;
      setDistance(0);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: false });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [distance]);

  return (
    <AnimatePresence>
      {distance > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-0 left-0 right-0 z-[999] flex items-center justify-center pt-[env(safe-area-inset-top)]"
        >
          <div className="mt-2 px-3 py-1.5 rounded-full bg-white shadow border text-emerald-700 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Atualizando...</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}