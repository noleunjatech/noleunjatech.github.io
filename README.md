# 시장 게이지 (PWA)

- S&P 500 (^GSPC) **역대 최고점(ATH) 대비 하락률** 게이지
- CNN **Fear & Greed Index** 게이지
- 주요 금융 위기 5개 구간의 최대 낙폭(peak→trough) 표시

## 실행

PWA/Service Worker는 `file://`에서 동작하지 않으므로 로컬 서버로 띄워야 합니다.

PowerShell 예시:

```powershell
cd C:\Users\slim8\Projects\snp500
node .\server.mjs
```

그 다음 브라우저에서 `http://localhost:5173/`로 접속하세요.

## 데이터 소스

- S&P 500: Yahoo Finance 차트 API (`^GSPC`)
- Fear & Greed: CNN Fear & Greed Index
- 브라우저에서 CORS가 막히면 공개 프록시(`r.jina.ai`)로 자동 재시도합니다.

## GitHub Pages 배포

워크플로우: `.github/workflows/pages.yml`

1) GitHub 저장소 → Settings → Pages
2) Source를 **GitHub Actions**로 설정
3) `main` 브랜치에 push 하면 자동으로 배포됩니다.

커스텀 도메인 사용 시 루트의 `CNAME` 파일을 포함합니다.

