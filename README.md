# 신청서 웹앱 매뉴얼

Google Apps Script로 만든 **범용 신청서 웹앱**입니다.
관리자는 Google 문서 한 장으로 신청서를 만들고, 사용자는 웹 화면에서 작성해 제출합니다.
제출한 내용은 같은 모양의 Google 문서로 Drive에 저장됩니다.

## 문서 목록

| 문서                                            | 내용                                                        |
| ----------------------------------------------- | ----------------------------------------------------------- |
| [설치 가이드](docs/install.md)                  | 처음 설치, `config.gs` 설정, 배포, 업데이트                 |
| [관리자 가이드](docs/admin-guide.md)            | 새 신청서 만들기, `양식목록` 탭, 저장 위치, 반영 시점       |
| [자리표시자 문법](docs/placeholder-syntax.md)   | `{{항목명}}` 규칙 정리: 유형 5종, 표시조건, 공통 자리표시자 |
| [자리표시자 예시](docs/placeholder-examples.md) | 문법별 쓰는 예, 자주 하는 실수                              |
| [문제 해결](docs/troubleshooting.md)            | 점검 화면, 오류 문구별 해결법, 자주 묻는 질문               |
| [사용자 안내](docs/user-guide.md)               | 작성·제출 방법                                              |
| [개발자 문서](docs/developer.md)                | 코드 구조, 처리 흐름, 캐시, 보안                            |

## 빠른 시작

1. **개발 담당자**: [설치 가이드](docs/install.md)대로 `setup`을 실행하고, `config.gs`에 ID를 넣은 뒤 배포합니다.
2. **관리자**: `신청서 웹앱/양식 문서` 폴더에서 예시 문서의 사본을 만들어 고칩니다. 그다음 `양식목록` 탭에 한 줄을 추가합니다. ([관리자 가이드](docs/admin-guide.md))
3. **관리자**: 웹앱 주소 끝에 `?check=1`을 붙여 열고, 양식이 **정상**인지 확인합니다.
4. 사용자에게 `웹앱주소?form=양식ID` 주소를 알려 줍니다.

## 웹앱 주소

| 주소                 | 화면                                  |
| -------------------- | ------------------------------------- |
| `…/exec`             | 신청서 목록 (`사용`에 체크된 양식만)  |
| `…/exec?form=양식ID` | 해당 신청서 작성 화면                 |
| `…/exec?check=1`     | 관리자용 양식 점검 화면 (캐시도 비움) |

## 소스 파일

| 파일                                       | 역할                                                     |
| ------------------------------------------ | -------------------------------------------------------- |
| [src/Code.gs](src/Code.gs)                 | 진입, 제출, 입력값 검증, 점검 화면                       |
| [src/Form.gs](src/Form.gs)                 | `양식목록` 탭 읽기, 양식 문서 해석(자리표시자 문법)      |
| [src/Document.gs](src/Document.gs)         | 결과 문서 생성, 저장 폴더·파일 이름                      |
| [src/Setup.gs](src/Setup.gs)               | 설치(`setup`), 예시 문서 다시 만들기(`resetSampleForms`) |
| [src/Util.gs](src/Util.gs)                 | 캐시, 공통 도우미                                        |
| [src/config.gs](src/config.gs)             | 설정 상수 (템플릿 시트 ID, 기본 저장 폴더, 캐시 시간 등) |
| [src/index.html](src/index.html)           | 사용자 화면 틀 (목록, 신청서, 점검, 오류, 제출 결과)     |
| [src/stylesheet.html](src/stylesheet.html) | 화면 CSS                                                 |
| [src/javascript.html](src/javascript.html) | 화면 동작 (클라이언트 JS)                                |
| [src/appsscript.json](src/appsscript.json) | 매니페스트 (시간대, 런타임, 웹앱 실행 설정)              |
