import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function BackButton({ className }) {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-8 w-8 md:hidden ${className || ""}`}
      onClick={() => navigate(-1)}
      aria-label="Voltar"
      title="Voltar"
    >
      <ArrowLeft className="w-4 h-4 text-slate-700" />
    </Button>
  );
}