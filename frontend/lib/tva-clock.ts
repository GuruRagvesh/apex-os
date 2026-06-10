export interface TVAClockState {
  companyDate: string; // YYYY-MM-DD
  companyTime: string; // HH:mm:ss
  timezone: string;
  unixMs: number;
}

export async function fetchTVAClock(): Promise<TVAClockState | null> {
  try {
    const res = await fetch('/api/tva/clock', {
      headers: {
        'Accept': 'application/json',
      },
      // Use cache: 'no-store' to ensure we get the fresh time
      cache: 'no-store'
    });
    
    if (!res.ok) {
      return null;
    }
    
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch TVA clock', err);
    return null;
  }
}
