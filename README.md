# DISTRIBUIDOR PUNTO PAS - ANÁLISIS DE DATOS

Dashboard empresarial para análisis de ventas e inventario con React, TypeScript, TailwindCSS, Recharts y Express.

## Ejecutar

```bash
npm install
npm run dev
```

La aplicación local abre en:

```bash
http://localhost:5173
```

Si el equipo está conectado por VPN, también puede abrirse desde:

```bash
http://IP_VPN:5173
```

Los endpoints internos del dashboard quedan bajo:

```bash
http://IP_VPN:5173/api
```

El puerto `9090` queda reservado para la API SIAPE:

```bash
http://26.193.73.242:9090/api
```

## Scripts

- `npm run dev`: frontend + backend
- `npm run build`: compila frontend
- `npm start`: levanta el backend y sirve el build si existe

## API SIAPE

Para conectar la API real, configure las variables de entorno según `.env.example`.

El dashboard limita las consultas históricas a máximo 3 meses para evitar sobrecarga del servicio.
