import { Modal } from "./Modal";
import { HINT_EVERY } from "../lib/play";

/** 게임 방법. 첫 방문에 자동으로 한 번 뜨고, 헤더 ❓로 다시 볼 수 있다. */
export function HelpModal({ total, onClose }: { total: number | null; onClose: () => void }) {
  const n = total ? total.toLocaleString() : "1만 5천여";
  return (
    <Modal title="❓ 게임 방법" onClose={onClose}>
      <div className="help">
        <p>
          매일 <b>보드게임 하나</b>가 정답이에요. 아는 보드게임을 입력하면 정답과 얼마나
          비슷한지 알려 드려요.
        </p>

        <h3>점수와 순위</h3>
        <ul>
          <li>
            <b>점수</b>(0~100) — 정답과의 유사도. 높을수록 비슷해요.
          </li>
          <li>
            <b>순위</b> — 전체 {n}개 게임 중 정답과 가까운 순서. <b>🔥 10위 안</b>이면 거의 다
            왔어요.
          </li>
        </ul>

        <h3>무엇이 비슷한가</h3>
        <p>추측마다 세 가지 막대가 붙어요. 어느 쪽이 맞고 어느 쪽이 먼지 보고 좁혀 가세요.</p>
        <ul>
          <li>
            <b>테마</b> — 판타지·경제·동물 같은 테마·카테고리 태그
          </li>
          <li>
            <b>메커니즘</b> — 덱빌딩·일꾼 놓기 같은 진행방식
          </li>
          <li>
            <b>웨이트</b> — 게임의 무게감(1~5, 높을수록 어렵고 복잡함)
          </li>
        </ul>
        <p className="help-example">
          예) 테마 90 · 메커니즘 20 → 테마는 맞았으니 <b>같은 테마의 다른 방식</b> 게임을
          찾아보세요. 태그가 하나도 안 겹치면 0이에요 — 그 방향이 아니라는 단서예요.
        </p>

        <h3>힌트</h3>
        <p>
          힌트는 8단계로, 인원·웨이트 같은 가벼운 것부터 테마·메커니즘 태그, 디자이너 순으로
          점점 구체적이 돼요. 첫 힌트는 바로 볼 수 있고, 이후 {HINT_EVERY}번 추측할 때마다 다음
          힌트가 열려요. 버튼에 다음 힌트가 무엇인지 미리 나와요. 힌트로 알게 된 태그를 가진
          게임을 추측하면 테마·메커니즘 막대가 올라가요. <b>같은 시리즈</b> 배지가 뜨면 시리즈는
          맞고 편만 다른 거예요.
        </p>

        <h3>매일 오전 9시</h3>
        <p>
          새 문제가 나와요. 놓친 문제는 <b>📅 지난 문제</b>에서 풀 수 있어요(통계에는 오늘
          문제만 기록돼요).
        </p>

        <button className="help-start" onClick={onClose}>
          시작하기
        </button>
      </div>
    </Modal>
  );
}
