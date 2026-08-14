export const sourceDefinitions = {
  jd: {
    profileName: "jd",
    privacyClass: "restricted",
    samples: [
      { id: "S01", url: "https://item.jd.com/100133046493.html", expectedText: "BCD-182M" },
      { id: "S05", url: "https://item.jd.com/100062957294.html", expectedText: "MR-531WSPZE" },
      { id: "S06", url: "https://item.jd.com/100044587428.html", expectedText: "BCD-505WGHTD14S8U1" },
    ],
  },
  public: {
    profileName: "public",
    privacyClass: "public",
    samples: [
      {
        id: "S02",
        url: "https://www.midea.cn/1/1000000000400692547080.html",
        expectedText: "MR-457WUSPZE",
      },
      {
        id: "S03",
        url: "https://www.midea.cn/1/1000000000400692547081.html",
        expectedText: "MR-457WUSPZE",
      },
      {
        id: "S04",
        url: "https://www.haier.com/cooling/20260104_284765.shtml",
        expectedText: "BCD-502WGHFDC9JWU1",
      },
    ],
  },
};
