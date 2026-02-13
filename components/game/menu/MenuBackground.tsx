"use client";

import React from "react";

export const MenuBackground = React.memo(function MenuBackground() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-sky-400">
      <style>
        {`
          @keyframes scrollGround {
            0% { background-position: 0 0; }
            100% { background-position: 0 100px; }
          }
          @keyframes floatClouds {
            0% { transform: translateX(0); }
            100% { transform: translateX(-100vw); }
          }
          .checkerboard-floor {
            background-image:
              linear-gradient(45deg, #ccc 25%, transparent 25%),
              linear-gradient(-45deg, #ccc 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #ccc 75%),
              linear-gradient(-45deg, transparent 75%, #ccc 75%);
            background-size: 100px 100px;
            background-color: #fff;
            transform: perspective(600px) rotateX(60deg) scale(2);
            transform-origin: bottom;
            animation: scrollGround 1s linear infinite;
            mask-image: linear-gradient(to top, black 0%, transparent 100%);
          }
        `}
      </style>

      {/* Blue Sky Gradient */}
      <div className="absolute inset-0 bg-linear-to-b from-sky-400 to-sky-200" />

      {/* Moving Clouds (CSS Shapes) */}
      <div className="absolute top-20 left-0 w-[200vw] flex justify-around opacity-60 animate-[floatClouds_60s_linear_infinite]">
        <div className="w-32 h-12 bg-white rounded-full relative">
          <div className="absolute -top-6 left-4 w-16 h-16 bg-white rounded-full"></div>
          <div className="absolute -top-4 left-14 w-12 h-12 bg-white rounded-full"></div>
        </div>
        <div className="w-48 h-16 bg-white rounded-full relative mt-12">
          <div className="absolute -top-8 left-6 w-20 h-20 bg-white rounded-full"></div>
          <div className="absolute -top-6 left-24 w-16 h-16 bg-white rounded-full"></div>
        </div>
        <div className="w-40 h-14 bg-white rounded-full relative -mt-4">
          <div className="absolute -top-6 left-8 w-16 h-16 bg-white rounded-full"></div>
        </div>
      </div>

      {/* Horizon Line */}
      <div className="absolute bottom-[35%] w-full h-8 bg-sky-100 blur-sm z-10" />

      {/* Checkerboard Floor */}
      <div className="absolute bottom-0 w-full h-[40%] overflow-hidden z-20">
        <div className="absolute inset-0 checkerboard-floor w-full h-[200%] -bottom-[50%]"></div>
      </div>

      {/* Decorative Elements */}
      <div className="absolute bottom-0 left-10 text-[10rem] opacity-10 rotate-12 select-none">🏁</div>
      <div className="absolute bottom-10 right-10 text-[8rem] opacity-10 -rotate-12 select-none">🏎️</div>
    </div>
  );
});
