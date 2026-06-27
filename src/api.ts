import type { DashboardResponse, Branch } from './types';

const apiUrl = (path: string) => `${path}`;

export async function fetchBranches(): Promise<Branch[]> {
  const response = await fetch(apiUrl('/api/branches'));
  if (!response.ok) throw new Error('No se pudieron cargar las sucursales');
  return response.json();
}

export async function fetchDashboard(params: {
  branch: string | null;
  periodMonths: number;
  search: string;
  category: string;
  brand: string;
  line: string;
  type: string;
  productCode: string;
  dateStart?: string | null;
  dateEnd?: string | null;
}): Promise<DashboardResponse> {
  const query = new URLSearchParams();
  if (params.branch) query.set('branch', params.branch);
  query.set('periodMonths', String(params.periodMonths));
  if (params.search) query.set('search', params.search);
  if (params.category) query.set('category', params.category);
  if (params.brand) query.set('brand', params.brand);
  if (params.line) query.set('line', params.line);
  if (params.type) query.set('type', params.type);
  if (params.productCode) query.set('productCode', params.productCode);
  if (params.dateStart) query.set('dateStart', params.dateStart);
  if (params.dateEnd) query.set('dateEnd', params.dateEnd);
  const response = await fetch(apiUrl(`/api/dashboard?${query.toString()}`));
  if (!response.ok) {
    const body = await response.text();
    try {
      const error = JSON.parse(body) as { message?: string };
      throw new Error(error?.message ? `${error.message} (HTTP ${response.status})` : `No se pudo cargar el dashboard (HTTP ${response.status})`);
    } catch {
      throw new Error(`No se pudo cargar el dashboard (HTTP ${response.status}): ${body.slice(0, 180)}`);
    }
  }
  return response.json();
}
