# S&P 500 고점 대비 하락률 (PWA)

S&P 500 지수(SPX)가 **역대 고점(ATH)** 대비 얼마나 하락했는지, 게이지 차트로 보여주는 단일 페이지 PWA입니다.

## 실행

PWA/Service Worker는 `file://`에서 동작하지 않으므로 로컬 서버로 띄워야 합니다.

PowerShell 예시:

```powershell
# Python이 있으면
py -m http.server 5173

# 또는 Node가 있으면 (둘 중 하나)
npx serve -l 5173 .
# npx http-server -p 5173 .
```

그 다음 브라우저에서 `http://localhost:5173/`로 접속하세요.

## 데이터

- 기본: Yahoo Finance 차트 API (`^GSPC`)
- 브라우저에서 CORS가 막히면 공개 프록시(`r.jina.ai`)로 자동 재시도

## GitHub Pages 배포

이 저장소에는 GitHub Pages 배포용 워크플로우가 포함되어 있습니다: `.github/workflows/pages.yml`

1) GitHub에서 해당 저장소 → Settings → Pages
2) Source를 **GitHub Actions**로 설정
3) `main` 브랜치에 push 하면 자동으로 배포됩니다.

참고: 원격 저장소에 push 권한이 없으면(403) 먼저 Collaborator 권한(Write 이상)을 받아야 합니다.
