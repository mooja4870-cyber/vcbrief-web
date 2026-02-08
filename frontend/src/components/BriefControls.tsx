import React from 'react';

interface BriefControlsProps {
  bioMin: number;
  onBioMinChange: (value: number) => void;
  aiMax: number;
  onAiMaxChange: (value: number) => void;
}

const BriefControls: React.FC<BriefControlsProps> = ({
  bioMin,
  onBioMinChange,
  aiMax,
  onAiMaxChange,
}) => {
  return (
    <section className="tool-section">
      <h3 className="tool-title">테마 비율 설정</h3>

      <div className="tool-control-grid">
        <label className="tool-control-field">
          <span>Bio 최소 개수</span>
          <input
            type="number"
            min={0}
            max={20}
            value={bioMin}
            onChange={(e) => onBioMinChange(Number(e.target.value || 0))}
          />
        </label>

        <label className="tool-control-field">
          <span>AI 최대 개수</span>
          <input
            type="number"
            min={0}
            max={20}
            value={aiMax}
            onChange={(e) => onAiMaxChange(Number(e.target.value || 0))}
          />
        </label>
      </div>

      <p className="tool-help">값 변경 시 브리프가 자동 갱신됩니다.</p>
    </section>
  );
};

export default BriefControls;
