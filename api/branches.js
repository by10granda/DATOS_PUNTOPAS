import { branches } from './_core.js';

export default function handler(_req, res) {
  res.status(200).json(branches);
}
