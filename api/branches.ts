const branches = [{ name: 'ALMACEN PAS' }];

export default function handler(_req: any, res: any) {
  res.status(200).json(branches);
}
