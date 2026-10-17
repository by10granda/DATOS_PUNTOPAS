import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSiapeProducts as loadLocalProducts } from './siape.ts';
import { loadSiapeProducts as loadVercelProducts } from '../api/_core.js';
import { buildDashboard as buildLocalDashboard } from './analytics.ts';
import { buildDashboard as buildVercelDashboard } from '../api/_core.js';

for (const [backend, loadProducts] of [['local', loadLocalProducts], ['vercel', loadVercelProducts]]) {
  test(`${backend}: stock comes from the selected branch inventory`, async (t) => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, SIAPE_AUTH_HEADER: 'Authorization', SIAPE_AUTH_PREFIX: 'Bearer' };
    t.after(() => { process.env = originalEnv; });
    const branches = ['ALMACEN PAS', 'VARIEDADES PAS', 'STIHL'];
    const suffixes = ['', '_SUCURSAL2', '_SUCURSAL3'];
    for (const [index, suffix] of suffixes.entries()) {
      process.env[`SIAPE_API_BASE_URL${suffix}`] = `https://branch-${index}.example`;
      process.env[`SIAPE_API_USER${suffix}`] = 'test-user';
      process.env[`SIAPE_API_PASSWORD${suffix}`] = 'test-password';
    }
    let stockResponse;
    let stockStatus = 200;
    const inventoryRequests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const { origin, pathname } = new URL(url);
      if (pathname === '/api/usuario/login') return Response.json({ token: 'test-token' });
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      if (pathname === '/api/item/inventario') {
        inventoryRequests.push(origin);
        return Response.json(stockResponse, { status: stockStatus });
      }
      if (pathname === '/api/item/reporteinventario') {
        return Response.json(['001', 'ZERO', 'NEGATIVE', 'MISSING'].map((codigo) => ({
          codigo,
          descripcion: codigo,
          bodegas: [{ bodegaALMACEN: 'GENERAL', stock: 99 }]
        })));
      }
      if (pathname === '/api/factura/reporteventas') {
        return Response.json([{ codigo: 'SOLD', cantidad_vendida: 1, fecha_venta: '2026-10-16T12:00:00' }]);
      }
      if (pathname === '/api/item/search3') return Response.json([]);
      throw new Error(`Unexpected path: ${pathname}`);
    });

    for (const [index, branch] of branches.entries()) {
      stockResponse = [
        { codigo: '001', disponible: String(index + 1.5) },
        { codigo: 'ZERO', disponible: 0 },
        { codigo: 'NEGATIVE', disponible: -2 },
        { codigo: 'SOLD', disponible: 7 }
      ];
      const products = await loadProducts('2026-10-16', '2026-10-16', 'hour', branch);
      const byCode = new Map(products.map((product) => [product.code, product]));
      assert.equal(byCode.get('001').stockTotal, index + 1.5);
      assert.equal(byCode.get('ZERO').stockTotal, 0);
      assert.equal(byCode.get('NEGATIVE').stockTotal, -2);
      assert.equal(byCode.get('MISSING').stockTotal, 0);
      assert.equal(byCode.get('SOLD').stockTotal, 7);
      assert.equal(byCode.get('001').warehouseStocks.GENERAL, 99);
      assert.ok(products.every((product) => product.branch === branch));
      for (const code of ['001', 'ZERO', 'NEGATIVE', 'MISSING']) {
        assert.equal(byCode.get(code).stock, 99);
      }
      assert.equal(byCode.get('SOLD').stock, 0);
      assert.equal(inventoryRequests.at(-1), `https://branch-${index}.example`);
    }

    stockResponse = { invalid: true };
    await assert.rejects(loadProducts('2026-10-16', '2026-10-16'), /Respuesta invalida/);
    stockResponse = [{ codigo: '001', disponible: null }];
    await assert.rejects(loadProducts('2026-10-16', '2026-10-16'), /Stock invalido/);
    stockStatus = 503;
    await assert.rejects(loadProducts('2026-10-16', '2026-10-16'), /Error SIAPE 503/);
  });
}

for (const [backend, loadProducts, dashboard] of [
  ['local', loadLocalProducts, (products, params) => buildLocalDashboard(products, [], params)],
  ['vercel', loadVercelProducts, buildVercelDashboard]
]) {
  test(`${backend}: union, missing metadata, real zeros and existing formulas`, async (t) => {
    const originalEnv = process.env;
    process.env = {
      ...originalEnv, SIAPE_API_BASE_URL: `https://union-${backend}.example`,
      SIAPE_API_USER: 'user', SIAPE_API_PASSWORD: 'password'
    };
    t.after(() => { process.env = originalEnv; });
    const existing = {
      codigo: 'EXISTING', descripcion: 'Original', marca: 'Brand', linea: 'Line', categoria: 'Category', tipo: 'Type',
      bodegas: [{ bodegaALMACEN: 'GENERAL', stock: 10 }],
      niveles_precio: [{ nivel: 'PUNTO PAS', precio: 20 }, { nivel: 'PVP', precio: 25 }],
      proveedores: [{ nombre_proveedor: 'Provider', costo_producto_proveedor: 10, costo_producto_proveedor_iva: 11.5,
        fecha_ultima_compra: '2026-10-01', cantidad_ultima_compra_proveedor: 4 }]
    };
    let catalogStatus = 200;
    const responses = {
      '/api/item/reporteinventario': [existing, existing, {
        codigo: 'ZERO', descripcion: 'Zero', marca: 'SIN MARCA', linea: '', categoria: 'SIN CATEGORIA', tipo: 'SIN TIPO',
        bodegas: [{ bodegaALMACEN: 'GENERAL', stock: 0 }],
        niveles_precio: [{ nivel: 'PVP', precio: 0 }],
        proveedores: [{ costo_producto_proveedor: 0, costo_producto_proveedor_iva: 0, cantidad_ultima_compra_proveedor: 0 }]
      }, { codigo: 'INVALID', descripcion: 'SIN AZUCAR', niveles_precio: [{ nivel: 'PVP', precio: '' }],
        bodegas: [{ bodegaALMACEN: 'GENERAL', stock: null }],
        proveedores: [{ costo_producto_proveedor: 'Infinity', costo_producto_proveedor_iva: '' }] },
        { codigo: 'INVALID', bodegas: [{ bodegaALMACEN: 'GENERAL', stock: '' }] }, { codigo: 'BARE' }],
      '/api/item/search3': [
        { codigo: 'EXISTING', descripcionItem: 'Do not overwrite', precioVentaSinImpuestos: 999 },
        { codigo: 'CATALOG', descripcionItem: 'Catalog', descripcionMarca: 'Catalog brand', descripcionCategoria: 'Catalog category',
          precioVentaSinImpuestos: 12, precioVentaConImpuestos: 13.8 },
        { codigo: 'CATALOG', descripcionItem: 'Catalog', descripcionMarca: 'Catalog brand', descripcionCategoria: 'Catalog category',
          precioVentaSinImpuestos: 12, precioVentaConImpuestos: 13.8 },
        { codigo: 'EMPTY', descripcionItem: '', precioVentaSinImpuestos: '' },
        { codigo: 'CATZERO', descripcionItem: 'Free', precioVentaSinImpuestos: 0 }
      ],
      '/api/item/inventario': [
        { codigo: 'EXISTING', disponible: 100 }, { codigo: 'EXISTING', disponible: 3 },
        { codigo: 'ZERO', disponible: 0 }, { codigo: 'STOCK', disponible: 8 }, { codigo: 'STOCKZERO', disponible: 0 }
      ],
      '/api/factura/reporteventas': [
        { codigo: 'EXISTING', descripcion: 'Sale description', cantidad_vendida: 2, precio_costo: 7, precio_venta: 30, fecha_venta: '2026-10-16T12:00:00' },
        { codigo: 'SOLD', descripcion: 'Sale only', cantidad_vendida: 5, precio_costo: 4, precio_venta: 10, fecha_venta: '2026-10-16T13:00:00' },
        { codigo: 'SALEZERO', cantidad_vendida: 1, precio_costo: 0, precio_venta: 0, fecha_venta: '2026-10-16T14:00:00' },
        { codigo: 'SALEEMPTY', cantidad_vendida: 1, precio_costo: '', precio_venta: null, fecha_venta: '2026-10-16T15:00:00' }
      ]
    };
    t.mock.method(globalThis, 'fetch', async (url) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/usuario/login') return Response.json({ token: 'token' });
      assert.ok(pathname in responses, pathname);
      return Response.json(responses[pathname], { status: pathname === '/api/item/search3' ? catalogStatus : 200 });
    });
    const products = await loadProducts('2026-10-16', '2026-10-16');
    const params = { branch: 'ALMACEN PAS', periodMonths: 1, search: '', category: 'TODOS', brand: 'TODAS',
      line: 'TODAS', type: 'TODOS', productCode: 'TODOS', dateStart: '2026-10-16', dateEnd: '2026-10-16' };
    const result = dashboard(products, params);
    const rows = new Map(result.rows.map((row) => [row.code, row]));
    assert.equal(products.length, 12);
    assert.equal(rows.size, products.length);
    assert.deepEqual(result.rows.map((row) => row.salesXMonths), [5, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(rows.get('BARE').description, '');
    assert.ok(rows.get('BARE').missingFields.includes('description'));
    for (const product of products) {
      assert.ok(Array.isArray(product.missingFields));
      assert.deepEqual(rows.get(product.code).missingFields, product.missingFields);
      assert.equal(new Set(product.missingFields).size, product.missingFields.length);
    }
    const original = rows.get('EXISTING');
    assert.equal(original.description, 'Original');
    assert.equal(original.stock, 10);
    assert.equal(original.stockTotal, 3);
    assert.equal(original.costProvider, 10);
    assert.equal(original.costWithIva, 11.5);
    assert.equal(original.publicCost, 20);
    assert.equal(original.pricePvp, 25);
    assert.ok(Math.abs(original.salePrice - 30) < 1e-10);
    assert.ok(Math.abs(original.publicCostWithIva - 34.5) < 1e-10);
    assert.equal(original.currentPriceWithIva, 23);
    assert.ok(Math.abs(original.unitProfit - 23) < 1e-10);
    assert.ok(Math.abs(original.totalProfit - 46) < 1e-10);
    assert.ok(Math.abs(original.marginPercent - 200) < 1e-10);
    assert.equal(original.currentMarginPercent, 100);
    assert.equal(original.rotation, 0.2);
    assert.equal(original.estimatedDaysInventory, 150);
    assert.deepEqual(original.missingFields, []);
    const catalog = rows.get('CATALOG');
    assert.equal(catalog.description, 'Catalog');
    assert.equal(catalog.brand, 'Catalog brand');
    assert.equal(catalog.category, 'Catalog category');
    assert.equal(catalog.line, '');
    assert.equal(catalog.provider, '');
    assert.equal(catalog.publicCost, 12);
    assert.equal(catalog.salesXMonths, 0);
    assert.ok(catalog.monthlySales.every((sale) => sale.quantity === 0));
    for (const key of ['costProvider', 'costWithIva', 'salePrice', 'saleDate', 'lastPurchase', 'lastPurchaseQuantity',
      'stockTotal', 'unitProfit', 'totalProfit', 'marginPercent', 'currentMarginPercent', 'rotation', 'estimatedDaysInventory', 'inventorySignal']) {
      assert.ok(catalog.missingFields.includes(key), key);
    }
    for (const key of ['description', 'brand', 'category', 'publicCost', 'publicCostWithIva', 'currentPriceWithIva', 'pricePvp']) {
      assert.ok(!catalog.missingFields.includes(key), key);
    }
    for (const code of ['STOCK', 'STOCKZERO']) {
      assert.equal(rows.get(code).stockTotal, code === 'STOCK' ? 8 : 0);
      assert.ok(!rows.get(code).missingFields.includes('stockTotal'));
      assert.equal(rows.get(code).description, '');
      assert.ok(rows.get(code).missingFields.includes('description'));
      assert.ok(rows.get(code).missingFields.includes('publicCost'));
    }
    const zero = rows.get('ZERO');
    for (const key of ['costProvider', 'costWithIva', 'publicCost', 'publicCostWithIva', 'currentPriceWithIva',
      'pricePvp', 'lastPurchaseQuantity', 'stockTotal', 'unitProfit', 'totalProfit', 'marginPercent', 'rotation']) {
      assert.equal(zero[key], 0, key);
      assert.ok(!zero.missingFields.includes(key), key);
    }
    for (const key of ['brand', 'line', 'category', 'type', 'provider', 'salePrice', 'saleDate']) {
      assert.ok(zero.missingFields.includes(key), key);
    }
    assert.ok(!rows.get('CATZERO').missingFields.includes('publicCost'));
    for (const code of ['INVALID', 'EMPTY', 'SALEEMPTY']) {
      assert.ok(rows.get(code).missingFields.includes('publicCost'), code);
      assert.ok(rows.get(code).missingFields.includes('unitProfit'), code);
    }
    assert.ok(rows.get('SALEEMPTY').missingFields.includes('salePrice'));
    assert.ok(rows.get('INVALID').missingFields.includes('rotation'));
    assert.ok(!rows.get('INVALID').missingFields.includes('description'));
    assert.ok(!rows.get('SALEZERO').missingFields.includes('salePrice'));
    assert.ok(!rows.get('SALEZERO').missingFields.includes('costProvider'));
    assert.equal(rows.get('SOLD').description, 'Sale only');
    assert.equal(dashboard(products, { ...params, productCode: 'CATALOG' }).rows.length, 1);
    catalogStatus = 503;
    await assert.rejects(loadProducts('2026-10-16', '2026-10-16'), /Error SIAPE 503.*search3/);
  });
}
