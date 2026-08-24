import { LactateTestResult } from "./components/lactate/LactateTestResult";
import { latestTest, previousTest } from "./data/lactateTests";
import { toLactateTestResultData } from "./utils/lactateAdapter";

export default function App() {
  const result = toLactateTestResultData(latestTest);
  const previous = toLactateTestResultData(previousTest);

  return (
    <main style={{ padding: "32px 16px", background: "#f3f2ee", minHeight: "100vh" }}>
      <LactateTestResult data={result} previousTest={previous} />
    </main>
  );
}
