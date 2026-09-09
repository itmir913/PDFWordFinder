import { describe, it, expect } from 'vitest';
import { fileNameOf, extensionOf, outputPathFor } from '../src/lib/paths.js';

describe('fileNameOf', () => {
  it('윈도우 경로에서 파일명을 뽑는다', () => {
    expect(fileNameOf('C:\\Users\\user\\생기부.pdf')).toBe('생기부.pdf');
  });

  it('POSIX 경로에서 파일명을 뽑는다', () => {
    expect(fileNameOf('/home/user/생기부.pdf')).toBe('생기부.pdf');
  });

  it('구분자가 없으면 그대로 돌려준다', () => {
    expect(fileNameOf('생기부.pdf')).toBe('생기부.pdf');
  });
});

describe('extensionOf', () => {
  it('확장자를 소문자로 돌려준다', () => {
    expect(extensionOf('C:\\a\\생기부.PDF')).toBe('pdf');
    expect(extensionOf('/a/b.xlsx')).toBe('xlsx');
  });

  it('점이 여러 개면 마지막 것만 본다', () => {
    expect(extensionOf('1학년.3반.xlsx')).toBe('xlsx');
  });

  it('확장자가 없으면 빈 문자열', () => {
    expect(extensionOf('C:\\a\\README')).toBe('');
  });

  // 예전에는 path.split('.').pop()이라, 점 없는 경로에서 경로 전체를
  // 확장자로 돌려줬다.
  it('점 없는 경로에서 경로 전체를 돌려주지 않는다', () => {
    expect(extensionOf('C:\\a\\README')).not.toContain('C:');
  });

  it('숨김 파일(.gitignore)은 확장자가 없는 것으로 본다', () => {
    expect(extensionOf('/a/.gitignore')).toBe('');
  });
});

describe('outputPathFor', () => {
  it('같은 폴더에 output_ 접두사를 붙인다', () => {
    expect(outputPathFor('C:\\Users\\user\\생기부.pdf')).toBe('C:\\Users\\user\\output_생기부.pdf');
    expect(outputPathFor('/home/user/생기부.pdf')).toBe('/home/user/output_생기부.pdf');
  });

  it('폴더 없이 파일명만 있어도 동작한다', () => {
    expect(outputPathFor('생기부.pdf')).toBe('output_생기부.pdf');
  });

  // 회귀: replace(/[^/\\]+$/, 'output_' + name)은 치환 문자열의 $ 시퀀스를
  // 해석한다. 파일명에 $&가 들어 있으면 경로가 조용히 깨졌다.
  it('파일명에 $ 시퀀스가 있어도 깨지지 않는다', () => {
    expect(outputPathFor('C:\\a\\$&보고서.pdf')).toBe('C:\\a\\output_$&보고서.pdf');
    expect(outputPathFor('C:\\a\\$1$`.xlsx')).toBe('C:\\a\\output_$1$`.xlsx');
  });
});
