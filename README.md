# Scan to EPUB

깔끔하게 파괴식 스캔한 PDF를 reflowable EPUB 3 전자책으로 재구성하는 Electron 앱.

## 동작

- 일반 페이지의 PDF 페이지 경계를 제거하고 본문을 연속 XHTML로 합친다.
- 목차, 챕터 표지, 장식 구성, 반전 페이지처럼 재현 손실이 큰 페이지는 전체 이미지로 보존한다.
- 사진·삽화·수식·복잡한 표는 원본 렌더링에서 잘라 삽입한다.
- 단순 표는 안전한 XHTML 표로 생성한다.
- 페이지 사이에 이어진 문단을 합친다.
- 실패한 페이지를 건너뛰고 나머지를 계속 처리하며, 다음 실행에서 실패·미처리 페이지만 이어서 분석한다.
- 지정한 요청 수만큼 병렬 처리하되 결과는 원본 순서로 정렬한다.
- 분석 결과의 텍스트를 앱에서 직접 수정할 수 있다.
- 첫 페이지 표지, 제목, 저자, 언어와 목차를 포함한 EPUB 3 파일을 저장한다.

## 사용

1. `Scan to EPUB-0.1.2-x64.exe`를 실행한다.
2. PDF를 선택하고 분석 범위를 정한다.
3. OpenAI 호환 `/chat/completions` 주소와 멀티모달 모델을 입력한다.
4. 원격 API라면 키를 입력한다. 인증 없는 로컬 서버는 비워도 된다.
5. `페이지 분석` 후 결과를 검수·수정한다.
6. `EPUB 저장`을 누른다.

API 키는 저장하지 않는다. API 주소와 모델 이름만 로컬 앱 설정에 남는다.
Chat Completions가 Base64 이미지를 거부하면 같은 서버의 Responses API로 자동 전환한다.

## 개발

```powershell
npm install
npm start
```

```powershell
npm test
npm run test:smoke
npm run dist
```

`npm run dist`는 `dist/Scan to EPUB-0.1.2-x64.exe`를 만든다. 생성기의 혼합 reflow/fixed-layout 샘플은 EPUBCheck 5.3.0에서 오류와 경고 없이 검증됐다.
