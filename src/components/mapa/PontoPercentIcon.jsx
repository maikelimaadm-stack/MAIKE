import React, { useEffect, useRef } from "react";

const BASE_COLOR = { r: 253, g: 232, b: 216 };
const FILL_COLOR = { r: 244, g: 177, b: 131 };

export default function PontoPercentIcon({ imageUrl, label, percent = 0 }) {
  const canvasRef = useRef(null);
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;

    const context = canvas.getContext("2d");
    const image = new Image();
    image.crossOrigin = "anonymous";

    image.onload = () => {
      const size = 96;
      const fillStartY = size - Math.round((nivel / 100) * size);

      canvas.width = size;
      canvas.height = size;
      context.clearRect(0, 0, size, size);
      context.drawImage(image, 0, 0, size, size);

      const imageData = context.getImageData(0, 0, size, size);
      const pixels = imageData.data;

      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const index = (y * size + x) * 4;
          const alpha = pixels[index + 3];

          if (alpha === 0) continue;

          const color = y >= fillStartY ? FILL_COLOR : BASE_COLOR;
          pixels[index] = color.r;
          pixels[index + 1] = color.g;
          pixels[index + 2] = color.b;
          pixels[index + 3] = alpha;
        }
      }

      context.putImageData(imageData, 0, 0);
    };

    image.src = imageUrl;
  }, [imageUrl, nivel]);

  if (!imageUrl) {
    return (
      <div className="relative h-[74px] w-[74px] flex items-center justify-center text-[10px] font-bold text-slate-700">
        {nivel}%
      </div>
    );
  }

  return (
    <div className="relative h-[74px] w-[74px] flex items-center justify-center">
      <canvas
        ref={canvasRef}
        aria-label={label || "Ícone"}
        className="h-[68px] w-[68px]"
      />
      <div className="absolute inset-x-0 top-[43%] -translate-y-1/2 flex items-center justify-center text-[10px] font-bold text-slate-700 pointer-events-none">
        {nivel}%
      </div>
    </div>
  );
}