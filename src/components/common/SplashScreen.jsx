import React from "react";
import { Loader2 } from "lucide-react";

export default function SplashScreen({ visible, logoUrl }) {
  return (
    <div className="">



      
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center justify-center">
          <div className="absolute h-36 w-36 rounded-full bg-emerald-500/20 animate-ping" />
          {logoUrl ?
          <img
            src={logoUrl}
            alt="Logo"
            className="h-32 w-32 object-contain animate-pulse" /> :


          <div className="h-32 w-32 rounded-md bg-emerald-600 text-white flex items-center justify-center text-2xl font-bold animate-pulse">
              M
            </div>
          }
        </div>
        <div className="flex items-center gap-2 text-emerald-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      </div>
    </div>);

}