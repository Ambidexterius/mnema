// The extension is part of the original filename. Preserve the displayed spelling.
export function fileNameKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

export const existingFileMessage = 'Файл с таким именем уже есть в проекте. Переименуйте файл и выберите его снова.';
export const uploadingFileMessage = 'Файл с таким именем уже загружается в проект. Чтобы добавить другой файл, переименуйте его и выберите снова.';
