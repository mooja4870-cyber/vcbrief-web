# Android Play Store 배포 준비

## 0) 필수 설치
- Android Studio (최신 안정 버전)
- JDK 21
- Android SDK Platform/Build-Tools

## 1) API 주소 설정
- `frontend/.env.production` 파일을 만들고 아래를 설정:

```env
VITE_API_BASE=https://api.your-domain.com
```

- `VITE_API_BASE`는 `https` 공개 주소여야 합니다.

## 2) 웹 자산 빌드 + 안드로이드 동기화

```bash
npm run android:prepare
```

## 3) 앱 번들(AAB) 생성

```bash
npm run android:bundle
```

- 기본 출력 경로:
  - `frontend/android/app/build/outputs/bundle/release/app-release.aab`
- `invalid source release: 21` 에러가 나면 JDK 21이 아닌 환경입니다. `JAVA_HOME`을 JDK 21로 맞춘 뒤 다시 실행하세요.

## 4) 서명 키(keystore) 준비
- Play Store 제출용 `release` 서명 키를 생성하고 `frontend/android/app` 아래에 배치합니다.
- 예시:

```bash
keytool -genkey -v -keystore vcbrief-release.keystore -alias vcbrief -keyalg RSA -keysize 2048 -validity 10000
```

## 5) `release` 서명 설정
- `frontend/android/keystore.properties` 생성:

```properties
storeFile=vcbrief-release.keystore
storePassword=YOUR_STORE_PASSWORD
keyAlias=vcbrief
keyPassword=YOUR_KEY_PASSWORD
```

- `frontend/android/app/build.gradle`의 `android { ... }`에 `signingConfigs`와 `buildTypes.release.signingConfig`를 연결해야 Play Store 업로드 가능한 최종 서명이 됩니다.

## 6) Play Console 업로드 전 체크
- 앱 패키지명: `com.vcbrief.app`
- 버전 증가: `frontend/android/app/build.gradle`의 `versionCode`, `versionName`
- 개인정보처리방침 URL 준비
- 앱 아이콘/스크린샷/설명문 준비
- 테스트 트랙(Internal testing) 업로드 후 동작 확인
