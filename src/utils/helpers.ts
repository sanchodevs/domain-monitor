const DAY_MS = 86400000;

export const normalizeDomain = (v = ''): string => v.trim().toLowerCase();

export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export const calculateAge = (dateStr: string): string => {
  if (!dateStr) return '';
  const created = new Date(dateStr);
  const now = new Date();
  let years = now.getFullYear() - created.getFullYear();
  let months = now.getMonth() - created.getMonth();
  if (months < 0) {
    years--;
    months += 12;
  }
  const parts: string[] = [];
  if (years) parts.push(`${years} yr`);
  if (months) parts.push(`${months} month`);
  return parts.join(' ') || '';
};

export const getExpiryDays = (expiry: string | null): number | null => {
  if (!expiry) return null;
  return Math.ceil((new Date(expiry).getTime() - Date.now()) / DAY_MS);
};

export const escapeCSV = (value: unknown): string => {
  if (value == null) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
};

export const generateTimestamp = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
};

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};
