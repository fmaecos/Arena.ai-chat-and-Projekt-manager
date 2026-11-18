import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function useResource(path, version) {
  const [result, setResult] = useState({ path: null, data: null, error: '' });
  useEffect(() => {
    if (!path) return undefined;
    let keep = true;
    api(path).then((data) => { if (keep) setResult({ path, data, error: '' }); })
      .catch((error) => { if (keep) setResult({ path, data: null, error: error.message }); });
    return () => { keep = false; };
  }, [path, version]);
  return result.path === path ? result : { data: null, error: '' };
}
