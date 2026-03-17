export const normAnimal = (v) => String(v || '').trim().toUpperCase();
export const normMarca = (v) => String(v || '').trim().toUpperCase();

export const sameAnimalMarca = (registro, numero, marca) => (
  normAnimal(registro?.numero_animal) === normAnimal(numero) &&
  normMarca(registro?.marca) === normMarca(marca)
);

export const registrosMesmoNumero = (registros = [], numero) => (
  registros.filter((item) => normAnimal(item?.numero_animal) === normAnimal(numero))
);

export const marcasDoNumero = (registros = [], numero) => (
  [...new Set(registrosMesmoNumero(registros, numero).map((item) => normMarca(item?.marca)).filter(Boolean))]
);

export const ultimoRegistroIdentidade = (registros = []) => (
  [...registros].sort((a, b) => new Date(b.data_pesagem || 0) - new Date(a.data_pesagem || 0))[0] || null
);