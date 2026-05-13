import React from "react";
import { Badge } from "@/components/ui/badge";

export default function BebedouroStatusBadge({ visual }) {
  const classes = {
    baixo: "bg-emerald-50 text-emerald-700 border-emerald-200",
    medio: "bg-amber-50 text-amber-700 border-amber-200",
    alto: "bg-red-50 text-red-700 border-red-200"
  };

  return <Badge variant="outline" className={`text-xs ${classes[visual?.nivel] || classes.baixo}`}>{visual?.label || "OK"}</Badge>;
}