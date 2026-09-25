import path from 'node:path';

/** Strict descendant check for canonical absolute paths, including Windows drives. */
export function isWithinDirectory(parent,child,paths=path) {
  if(!paths.isAbsolute(parent)||!paths.isAbsolute(child))return false;
  const relative=paths.relative(parent,child);
  return relative!==''&&relative!=='..'&&!relative.startsWith(`..${paths.sep}`)&&!paths.isAbsolute(relative);
}
