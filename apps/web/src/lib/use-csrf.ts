'use client';

import { useEffect, useState } from 'react';

/** tf_csrf çerezinin değerini istemcide okur (çift-gönderim deseni). */
export function useCsrf(): string | undefined {
  const [csrf, setCsrf] = useState<string | undefined>(undefined);

  useEffect(() => {
    const match = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('tf_csrf='));
    setCsrf(match ? decodeURIComponent(match.slice('tf_csrf='.length)) : undefined);
  }, []);

  return csrf;
}
