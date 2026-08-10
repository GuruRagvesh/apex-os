"use client";

import { useEffect } from "react";
import styles from "@apex/sales-crm-shared/styles/dashboard.module.css";

export default function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={styles["analytics-toast"]}>
      {message}
    </div>
  );
}
